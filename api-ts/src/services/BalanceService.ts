import { Context, Effect, Layer } from 'effect'
import type { Wallet } from '../db'
import { logger } from '../lib/logger'
import { fetchTokenPrices } from '../lib/prices'
import { RPC_ENDPOINTS, NATIVE_TOKENS } from '../config/chains'

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
				const balance = Number(balanceWei) / 10 ** decimals
				return balance.toFixed(6)
			}
		} catch (e) {
			logger.error(
				{ err: e },
				`Failed to fetch ${chain} balance (attempt ${attempt}/${maxAttempts}, rpc=${rpcUrl})`,
			)
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
		logger.error({ err: e }, 'Failed to fetch SOL balance')
	}

	return '0'
}

// All native symbols across EVM chains (for pre-fetching prices in parallel with balances)
const ALL_NATIVE_SYMBOLS = [...new Set(
	['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc']
		.map((c) => NATIVE_TOKENS[c]?.symbol)
		.filter(Boolean),
)] as string[]

export const BalanceServiceLive = Layer.succeed(BalanceService, {
	getWalletBalances: (wallet: Wallet) =>
		Effect.tryPromise({
			try: async () => {
				const balances: TokenBalance[] = []

				if (wallet.chainType === 'solana') {
					// Fetch SOL balance and price in parallel
					const [balance, prices] = await Promise.all([
						fetchSolanaBalance(wallet.address),
						fetchTokenPrices(['SOL']),
					])
					const price = prices.SOL?.usd ?? 0
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
					const evmChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc']

					// Fetch ALL chain balances AND prices in parallel
					const [chainBalances, prices] = await Promise.all([
						Promise.all(
							evmChains.map(async (chain) => ({
								chain,
								balance: await fetchEvmNativeBalance(wallet.address, chain),
							})),
						),
						fetchTokenPrices(ALL_NATIVE_SYMBOLS),
					])

					// Assemble results (only chains with balance > 0)
					for (const { chain, balance } of chainBalances) {
						const balanceNum = parseFloat(balance)
						if (balanceNum > 0) {
							const token = NATIVE_TOKENS[chain]
							if (!token) continue
							const price = prices[token.symbol]?.usd ?? 0
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
			try: async () => {
				const prices = await fetchTokenPrices([symbol])
				return prices[symbol.toUpperCase()]?.usd ?? 0
			},
			catch: (e) => new Error(`Failed to fetch price for ${symbol}: ${e}`),
		}),
})
