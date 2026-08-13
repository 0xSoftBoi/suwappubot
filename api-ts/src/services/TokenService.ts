import { Context, Effect, Layer } from 'effect'
import {
	COMMON_TOKENS,
	ROBINHOOD_TOKEN_DECIMALS,
	TEMPO_TOKEN_DECIMALS,
} from '../config/tokenRegistry'

// Re-exported for downstream consumers (agent.ts, mcp.ts, etc.) that import
// these names from '../services' — the token registry itself now lives in
// config/tokenRegistry.ts (see docs/plans/market-data-parity.md Phase 3), the
// single source of truth shared with routes/data.ts's reference API.
export { COMMON_TOKENS, ROBINHOOD_TOKEN_DECIMALS, TEMPO_TOKEN_DECIMALS }

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
	robinhood: {
		id: 4663,
		key: 'robinhood',
		name: 'Robinhood Chain',
		nativeToken: 'ETH',
		nativeTokenAddress: '0x0000000000000000000000000000000000000000',
	},
	hood: {
		id: 4663,
		key: 'robinhood',
		name: 'Robinhood Chain',
		nativeToken: 'ETH',
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

// COMMON_TOKENS / TEMPO_TOKEN_DECIMALS / ROBINHOOD_TOKEN_DECIMALS now live in
// config/tokenRegistry.ts (imported + re-exported above) — single source of
// truth shared with routes/data.ts's reference API.

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
			// 6-decimal stablecoins (USDC, USDT, TIP-20 tokens on Tempo, USDG on Robinhood Chain).
			// USDG MUST stay here: it is 6dp on-chain, and defaulting it to 18 would
			// misprice every Robinhood Chain quote by 1e12.
			const DECIMALS_6 = new Set(['USDC', 'USDT', 'USDC.E', 'BUSD', 'PATHUSD', 'ALPHAUSD', 'BETAUSD', 'THETAUSD', 'USDG'])

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
