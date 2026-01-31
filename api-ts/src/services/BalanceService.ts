import { Context, Effect, Layer } from 'effect'
import { Alchemy, Network } from 'alchemy-sdk'
import type { Wallet } from '../db'

// Token balance with USD value
export interface TokenBalance {
	symbol: string
	name: string
	address: string
	chain: string
	balance: string
	usdValue: number
	decimals: number
	logoUrl?: string
}

// Alchemy network mapping
const ALCHEMY_NETWORKS: Record<string, Network> = {
	ethereum: Network.ETH_MAINNET,
	polygon: Network.MATIC_MAINNET,
	arbitrum: Network.ARB_MAINNET,
	optimism: Network.OPT_MAINNET,
	base: Network.BASE_MAINNET,
}

// Chain RPC endpoints (fallback for non-Alchemy chains)
const RPC_ENDPOINTS: Record<string, string> = {
	ethereum: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
	polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
	arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com',
	optimism: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com',
	base: process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
	bsc: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
	solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
}

// Native token info by chain
const NATIVE_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
	ethereum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	polygon: { symbol: 'POL', name: 'Polygon', decimals: 18 },
	arbitrum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	optimism: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	base: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	bsc: { symbol: 'BNB', name: 'BNB Chain', decimals: 18 },
	solana: { symbol: 'SOL', name: 'Solana', decimals: 9 },
}

// Get or create Alchemy client for a chain
function getAlchemyClient(chain: string): Alchemy | null {
	const apiKey = process.env.ALCHEMY_API_KEY
	const network = ALCHEMY_NETWORKS[chain]

	if (!apiKey || !network) {
		return null
	}

	return new Alchemy({ apiKey, network })
}

// Simple price cache (in production, use Redis)
const priceCache: Map<string, { price: number; timestamp: number }> = new Map()
const PRICE_CACHE_TTL = 60 * 1000 // 1 minute

export interface BalanceServiceInterface {
	readonly getWalletBalances: (wallet: Wallet) => Effect.Effect<TokenBalance[], Error>
	readonly getTokenPrice: (symbol: string) => Effect.Effect<number, Error>
	readonly getMultiChainBalances: (address: string, chains?: string[]) => Effect.Effect<TokenBalance[], Error>
}

export class BalanceService extends Context.Tag('BalanceService')<
	BalanceService,
	BalanceServiceInterface
>() {}

// Fetch token balances using Alchemy SDK
async function fetchAlchemyBalances(address: string, chain: string): Promise<TokenBalance[]> {
	const alchemy = getAlchemyClient(chain)
	if (!alchemy) {
		// Fall back to native balance only
		const balance = await fetchEvmNativeBalance(address, chain)
		const balanceNum = parseFloat(balance)
		if (balanceNum <= 0) return []

		const token = NATIVE_TOKENS[chain]
		const price = await fetchTokenPrice(token.symbol)
		return [{
			symbol: token.symbol,
			name: token.name,
			address: 'native',
			chain,
			balance,
			usdValue: balanceNum * price,
			decimals: token.decimals,
		}]
	}

	try {
		const balances: TokenBalance[] = []

		// Get native balance
		const nativeBalance = await alchemy.core.getBalance(address)
		const token = NATIVE_TOKENS[chain]
		const nativeBalanceNum = Number(nativeBalance) / Math.pow(10, token.decimals)

		if (nativeBalanceNum > 0) {
			const price = await fetchTokenPrice(token.symbol)
			balances.push({
				symbol: token.symbol,
				name: token.name,
				address: 'native',
				chain,
				balance: nativeBalanceNum.toFixed(6),
				usdValue: nativeBalanceNum * price,
				decimals: token.decimals,
			})
		}

		// Get token balances using Alchemy
		const tokenBalances = await alchemy.core.getTokenBalances(address)

		for (const tb of tokenBalances.tokenBalances) {
			if (!tb.tokenBalance || tb.tokenBalance === '0x0' || tb.tokenBalance === '0') continue

			try {
				const metadata = await alchemy.core.getTokenMetadata(tb.contractAddress)
				if (!metadata.decimals || !metadata.symbol) continue

				const rawBalance = BigInt(tb.tokenBalance)
				const balanceNum = Number(rawBalance) / Math.pow(10, metadata.decimals)

				if (balanceNum > 0.0001) { // Filter dust
					const price = await fetchTokenPrice(metadata.symbol)
					balances.push({
						symbol: metadata.symbol,
						name: metadata.name || metadata.symbol,
						address: tb.contractAddress,
						chain,
						balance: balanceNum.toFixed(6),
						usdValue: balanceNum * price,
						decimals: metadata.decimals,
						logoUrl: metadata.logo || undefined,
					})
				}
			} catch {
				// Skip tokens we can't get metadata for
			}
		}

		return balances
	} catch (e) {
		console.error(`Failed to fetch Alchemy balances for ${chain}:`, e)
		return []
	}
}

// Fetch native balance for EVM chains
async function fetchEvmNativeBalance(address: string, chain: string): Promise<string> {
	const rpcUrl = RPC_ENDPOINTS[chain]
	if (!rpcUrl) return '0'

	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'eth_getBalance',
				params: [address, 'latest'],
				id: 1,
			}),
		})

		const data = (await response.json()) as { result?: string }
		if (data.result) {
			const balanceWei = BigInt(data.result)
			const decimals = NATIVE_TOKENS[chain]?.decimals || 18
			const balance = Number(balanceWei) / Math.pow(10, decimals)
			return balance.toFixed(6)
		}
	} catch (e) {
		console.error(`Failed to fetch ${chain} balance:`, e)
	}

	return '0'
}

// Fetch SOL balance
async function fetchSolanaBalance(address: string): Promise<string> {
	const rpcUrl = RPC_ENDPOINTS.solana
	if (!rpcUrl) return '0'

	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getBalance',
				params: [address],
				id: 1,
			}),
		})

		const data = (await response.json()) as { result?: { value?: number } }
		if (data.result?.value !== undefined) {
			const lamports = data.result.value
			const sol = lamports / 1e9
			return sol.toFixed(6)
		}
	} catch (e) {
		console.error('Failed to fetch SOL balance:', e)
	}

	return '0'
}

// Fetch token price from CoinGecko (free tier)
async function fetchTokenPrice(symbol: string): Promise<number> {
	// Check cache first
	const cached = priceCache.get(symbol.toLowerCase())
	if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
		return cached.price
	}

	// Map symbols to CoinGecko IDs
	const coinGeckoIds: Record<string, string> = {
		eth: 'ethereum',
		sol: 'solana',
		matic: 'matic-network',
		bnb: 'binancecoin',
		usdc: 'usd-coin',
		usdt: 'tether',
	}

	const id = coinGeckoIds[symbol.toLowerCase()]
	if (!id) return 0

	try {
		const response = await fetch(
			`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
		)
		const data = (await response.json()) as Record<string, { usd?: number }>

		if (data[id]?.usd) {
			const price = data[id].usd
			priceCache.set(symbol.toLowerCase(), { price, timestamp: Date.now() })
			return price
		}
	} catch (e) {
		console.error(`Failed to fetch price for ${symbol}:`, e)
	}

	return 0
}

export const BalanceServiceLive = Layer.succeed(BalanceService, {
	getWalletBalances: (wallet: Wallet) =>
		Effect.tryPromise({
			try: async () => {
				const balances: TokenBalance[] = []

				if (wallet.chainType === 'solana') {
					// Fetch SOL balance
					const balance = await fetchSolanaBalance(wallet.address)
					const price = await fetchTokenPrice('SOL')
					const usdValue = parseFloat(balance) * price

					balances.push({
						symbol: 'SOL',
						name: 'Solana',
						address: 'native',
						chain: 'solana',
						balance,
						usdValue,
						decimals: 9,
					})
				} else {
					// EVM wallet - use Alchemy for supported chains
					const alchemyChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']
					const fallbackChains = ['bsc']

					// Fetch from Alchemy-supported chains in parallel
					const alchemyResults = await Promise.all(
						alchemyChains.map((chain) => fetchAlchemyBalances(wallet.address, chain))
					)
					balances.push(...alchemyResults.flat())

					// Fallback for non-Alchemy chains
					for (const chain of fallbackChains) {
						const balance = await fetchEvmNativeBalance(wallet.address, chain)
						const balanceNum = parseFloat(balance)

						if (balanceNum > 0) {
							const token = NATIVE_TOKENS[chain]
							const price = await fetchTokenPrice(token.symbol)
							const usdValue = balanceNum * price

							balances.push({
								symbol: token.symbol,
								name: token.name,
								address: 'native',
								chain,
								balance,
								usdValue,
								decimals: token.decimals,
							})
						}
					}
				}

				return balances
			},
			catch: (e) => new Error(`Failed to fetch wallet balances: ${e}`),
		}),

	getTokenPrice: (symbol: string) =>
		Effect.tryPromise({
			try: () => fetchTokenPrice(symbol),
			catch: (e) => new Error(`Failed to fetch price for ${symbol}: ${e}`),
		}),

	getMultiChainBalances: (address: string, chains?: string[]) =>
		Effect.tryPromise({
			try: async () => {
				const targetChains = chains || ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']
				const results = await Promise.all(
					targetChains.map((chain) => fetchAlchemyBalances(address, chain))
				)
				return results.flat()
			},
			catch: (e) => new Error(`Failed to fetch multi-chain balances: ${e}`),
		}),
})
