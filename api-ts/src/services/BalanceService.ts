import { Context, Effect, Layer } from 'effect'
import type { Wallet } from '../db'
import { RPC_ENDPOINTS, NATIVE_TOKENS } from '../config/chains'
import { COMMON_TOKENS } from './TokenService'

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

// Fetch ERC-20 token balances via batch JSON-RPC
async function fetchErc20Balances(
	address: string,
	chain: string,
	chainId: number
): Promise<Array<{ symbol: string; balance: string; decimals: number; address: string }>> {
	const rpcUrl = RPC_ENDPOINTS[chain]
	if (!rpcUrl) return []

	const tokens = COMMON_TOKENS[chainId]
	if (!tokens) return []

	// Filter out native token (0x000...0)
	const erc20Entries = Object.entries(tokens).filter(
		([, addr]) => addr !== '0x0000000000000000000000000000000000000000'
	)
	if (erc20Entries.length === 0) return []

	// Build batch JSON-RPC calls for balanceOf(address)
	// balanceOf selector: 0x70a08231 + address padded to 32 bytes
	const paddedAddress = address.slice(2).toLowerCase().padStart(64, '0')
	const callData = `0x70a08231${paddedAddress}`

	const batchRequests = erc20Entries.map(([, tokenAddr], i) => ({
		jsonrpc: '2.0' as const,
		method: 'eth_call',
		params: [{ to: tokenAddr, data: callData }, 'latest'],
		id: i + 1,
	}))

	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(batchRequests),
			signal: AbortSignal.timeout(10000),
		})

		const results = (await response.json()) as Array<{ id: number; result?: string }>
		const balances: Array<{ symbol: string; balance: string; decimals: number; address: string }> = []

		for (let i = 0; i < results.length; i++) {
			const result = results[i]
			if (!result?.result || result.result === '0x' || result.result === '0x0') continue

			const [symbol] = erc20Entries[i]
			const balanceWei = BigInt(result.result)
			if (balanceWei === 0n) continue

			const decimals = symbol === 'USDC' || symbol === 'USDT' || symbol === 'USDC.e' ? 6 : 18
			const balance = Number(balanceWei) / Math.pow(10, decimals)

			balances.push({
				symbol,
				balance: balance.toFixed(6),
				decimals,
				address: erc20Entries[i][1],
			})
		}

		return balances
	} catch (e) {
		console.error(`Failed to fetch ERC-20 balances on ${chain}:`, e)
		return []
	}
}

// Fetch SPL token balances
async function fetchSplTokenBalances(
	address: string
): Promise<Array<{ symbol: string; balance: string; decimals: number; address: string }>> {
	const rpcUrl = RPC_ENDPOINTS.solana
	if (!rpcUrl) return []

	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'getTokenAccountsByOwner',
				params: [
					address,
					{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
					{ encoding: 'jsonParsed' },
				],
				id: 1,
			}),
			signal: AbortSignal.timeout(10000),
		})

		const data = (await response.json()) as {
			result?: {
				value?: Array<{
					account: {
						data: {
							parsed: {
								info: {
									mint: string
									tokenAmount: {
										uiAmount: number
										decimals: number
									}
								}
							}
						}
					}
				}>
			}
		}

		if (!data.result?.value) return []

		const balances: Array<{ symbol: string; balance: string; decimals: number; address: string }> = []

		for (const account of data.result.value) {
			const info = account.account.data.parsed.info
			if (info.tokenAmount.uiAmount > 0) {
				balances.push({
					symbol: info.mint.slice(0, 8), // Shortened mint as fallback symbol
					balance: info.tokenAmount.uiAmount.toFixed(6),
					decimals: info.tokenAmount.decimals,
					address: info.mint,
				})
			}
		}

		return balances
	} catch (e) {
		console.error('Failed to fetch SPL token balances:', e)
		return []
	}
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
		dai: 'dai',
		wbtc: 'wrapped-bitcoin',
		link: 'chainlink',
		uni: 'uniswap',
		aave: 'aave',
		busd: 'binance-usd',
		avax: 'avalanche-2',
		'usdc.e': 'usd-coin',
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

// Chain key to chain ID mapping
const CHAIN_KEY_TO_ID: Record<string, number> = {
	ethereum: 1,
	optimism: 10,
	bsc: 56,
	polygon: 137,
	arbitrum: 42161,
	base: 8453,
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

					// Fetch SPL token balances
					const splTokens = await fetchSplTokenBalances(wallet.address)
					for (const token of splTokens) {
						balances.push({
							symbol: token.symbol,
							name: token.symbol,
							address: token.address,
							chain: 'solana',
							balance: token.balance,
							usdValue: 0, // Price lookup for SPL tokens would need mint-to-symbol mapping
							decimals: token.decimals,
						})
					}
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

						// Fetch ERC-20 balances for this chain
						const chainId = CHAIN_KEY_TO_ID[chain]
						if (chainId) {
							const erc20Balances = await fetchErc20Balances(wallet.address, chain, chainId)
							for (const erc20 of erc20Balances) {
								const price = await fetchTokenPrice(erc20.symbol)
								const balNum = parseFloat(erc20.balance)
								balances.push({
									symbol: erc20.symbol,
									name: erc20.symbol,
									address: erc20.address,
									chain,
									balance: erc20.balance,
									usdValue: balNum * price,
									decimals: erc20.decimals,
								})
							}
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
