import { Context, Effect, Layer } from 'effect'
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
}

// Chain RPC endpoints (use env vars in production, Alchemy as primary fallback)
const alchemyKey = process.env.ALCHEMY_API_KEY || ''
const RPC_ENDPOINTS: Record<string, string> = {
	ethereum: process.env.ETH_RPC_URL || (alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://eth.llamarpc.com'),
	arbitrum: process.env.ARBITRUM_RPC_URL || (alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://arbitrum.llamarpc.com'),
	optimism: process.env.OPTIMISM_RPC_URL || (alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://optimism.llamarpc.com'),
	polygon: process.env.POLYGON_RPC_URL || (alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://polygon.llamarpc.com'),
	base: process.env.BASE_RPC_URL || (alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://base.llamarpc.com'),
	bsc: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
	solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
}

// Native token info by chain
const NATIVE_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
	ethereum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	polygon: { symbol: 'MATIC', name: 'Polygon', decimals: 18 },
	arbitrum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	optimism: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	base: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	bsc: { symbol: 'BNB', name: 'BNB Chain', decimals: 18 },
	solana: { symbol: 'SOL', name: 'Solana', decimals: 9 },
}

// Simple price cache (in production, use Redis)
const priceCache: Map<string, { price: number; timestamp: number }> = new Map()
const PRICE_CACHE_TTL = 60 * 1000 // 1 minute

export interface BalanceServiceInterface {
	readonly getWalletBalances: (wallet: Wallet) => Effect.Effect<TokenBalance[], Error>
	readonly getTokenPrice: (symbol: string) => Effect.Effect<number, Error>
}

export class BalanceService extends Context.Tag('BalanceService')<
	BalanceService,
	BalanceServiceInterface
>() {}

// Fetch native balance for EVM chains (1 retry, 5s timeout per attempt)
async function fetchEvmNativeBalance(address: string, chain: string): Promise<string> {
	const rpcUrl = RPC_ENDPOINTS[chain]
	if (!rpcUrl) return '0'

	const maxAttempts = 2
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
				signal: AbortSignal.timeout(5000),
			})

			const data = (await response.json()) as { result?: string }
			if (data.result) {
				const balanceWei = BigInt(data.result)
				const decimals = NATIVE_TOKENS[chain]?.decimals || 18
				const balance = Number(balanceWei) / Math.pow(10, decimals)
				return balance.toFixed(6)
			}
		} catch (e) {
			console.error(`Failed to fetch ${chain} balance (attempt ${attempt}/${maxAttempts}, rpc=${rpcUrl}):`, e)
			if (attempt < maxAttempts) continue
		}
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
					// EVM wallet - fetch balance for common chains
					const evmChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc']

					for (const chain of evmChains) {
						const balance = await fetchEvmNativeBalance(wallet.address, chain)
						const balanceNum = parseFloat(balance)

						// Only include if balance > 0
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
})
