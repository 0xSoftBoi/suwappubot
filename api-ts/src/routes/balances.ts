import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { telegramAuth } from '../middleware'
import { UserService, WalletService, BalanceService } from '../services'
import { runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse } from '../errors'

const balancesRoutes = new Hono()

// All balance routes require Telegram auth
balancesRoutes.use('*', telegramAuth())

// GET /webapp/balances - Get balances for all user wallets
balancesRoutes.get('/', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const chainFilter = c.req.query('chain') // Optional: filter by chain
	const walletFilter = c.req.query('wallet') // Optional: filter by wallet address

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService
			const balanceService = yield* BalanceService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return {
					totalUsdValue: 0,
					tokens: [],
					wallets: [],
					lastUpdated: new Date().toISOString(),
				}
			}

			const user = userOption.value
			let wallets = yield* walletService.getActiveWallets(user.id)

			// Filter by wallet address if specified
			if (walletFilter) {
				wallets = wallets.filter((w) => w.address.toLowerCase() === walletFilter.toLowerCase())
			}

			if (wallets.length === 0) {
				return {
					totalUsdValue: 0,
					tokens: [],
					wallets: [],
					lastUpdated: new Date().toISOString(),
				}
			}

			// Parse chain filter
			const chains = chainFilter ? chainFilter.split(',').map((c) => c.trim()) : undefined

			// Fetch balances for all wallets
			const allTokens: Array<{
				symbol: string
				name: string
				address: string
				chain: string
				balance: string
				usdValue: number
				decimals: number
				logoUrl?: string
				walletAddress: string
			}> = []

			for (const wallet of wallets) {
				// Use multi-chain fetch for EVM wallets
				if (wallet.chainType === 'evm') {
					const balancesResult = yield* Effect.either(
						balanceService.getMultiChainBalances(wallet.address, chains)
					)

					if (Either.isRight(balancesResult)) {
						for (const token of balancesResult.right) {
							allTokens.push({
								...token,
								walletAddress: wallet.address,
							})
						}
					}
				} else {
					// Solana wallet
					const balancesResult = yield* Effect.either(balanceService.getWalletBalances(wallet))

					if (Either.isRight(balancesResult)) {
						for (const token of balancesResult.right) {
							allTokens.push({
								...token,
								walletAddress: wallet.address,
							})
						}
					}
				}
			}

			// Filter by chain if specified
			const filteredTokens = chains
				? allTokens.filter((t) => chains.includes(t.chain))
				: allTokens

			// Calculate total USD value
			const totalUsdValue = filteredTokens.reduce((sum, token) => sum + token.usdValue, 0)

			// Aggregate tokens by symbol across wallets
			const aggregatedTokens = aggregateTokens(filteredTokens)

			return {
				totalUsdValue,
				tokens: aggregatedTokens,
				wallets: wallets.map((w) => ({
					address: w.address,
					name: w.name,
					chainType: w.chainType,
				})),
				lastUpdated: new Date().toISOString(),
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /webapp/balances/:address - Get balances for a specific wallet
balancesRoutes.get('/:address', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const address = decodeURIComponent(c.req.param('address'))
	const chainFilter = c.req.query('chain')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService
			const balanceService = yield* BalanceService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return c.json({ error: 'User not found' }, 404)
			}

			const user = userOption.value
			const wallet = yield* walletService.getWalletByAddress(user.id, address)

			if (!wallet) {
				return {
					error: 'Wallet not found',
					tokens: [],
					totalUsdValue: 0,
				}
			}

			const chains = chainFilter ? chainFilter.split(',').map((c) => c.trim()) : undefined

			// Fetch balances
			let tokens: Array<{
				symbol: string
				name: string
				address: string
				chain: string
				balance: string
				usdValue: number
				decimals: number
				logoUrl?: string
			}> = []

			if (wallet.chainType === 'evm') {
				const balancesResult = yield* Effect.either(
					balanceService.getMultiChainBalances(wallet.address, chains)
				)
				if (Either.isRight(balancesResult)) {
					tokens = balancesResult.right
				}
			} else {
				const balancesResult = yield* Effect.either(balanceService.getWalletBalances(wallet))
				if (Either.isRight(balancesResult)) {
					tokens = balancesResult.right
				}
			}

			// Filter by chain if specified
			const filteredTokens = chains ? tokens.filter((t) => chains.includes(t.chain)) : tokens

			const totalUsdValue = filteredTokens.reduce((sum, token) => sum + token.usdValue, 0)

			return {
				wallet: {
					address: wallet.address,
					name: wallet.name,
					chainType: wallet.chainType,
				},
				tokens: filteredTokens,
				totalUsdValue,
				lastUpdated: new Date().toISOString(),
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// Helper: Aggregate tokens by symbol across chains/wallets
function aggregateTokens(
	tokens: Array<{
		symbol: string
		name: string
		address: string
		chain: string
		balance: string
		usdValue: number
		decimals: number
		logoUrl?: string
		walletAddress: string
	}>
) {
	const aggregated = new Map<
		string,
		{
			symbol: string
			name: string
			totalBalance: number
			totalUsdValue: number
			decimals: number
			logoUrl?: string
			chains: Array<{ chain: string; balance: string; usdValue: number; walletAddress: string }>
		}
	>()

	for (const token of tokens) {
		const key = token.symbol.toUpperCase()
		const existing = aggregated.get(key)

		if (existing) {
			existing.totalBalance += parseFloat(token.balance)
			existing.totalUsdValue += token.usdValue
			existing.chains.push({
				chain: token.chain,
				balance: token.balance,
				usdValue: token.usdValue,
				walletAddress: token.walletAddress,
			})
		} else {
			aggregated.set(key, {
				symbol: token.symbol,
				name: token.name,
				totalBalance: parseFloat(token.balance),
				totalUsdValue: token.usdValue,
				decimals: token.decimals,
				logoUrl: token.logoUrl,
				chains: [
					{
						chain: token.chain,
						balance: token.balance,
						usdValue: token.usdValue,
						walletAddress: token.walletAddress,
					},
				],
			})
		}
	}

	// Convert to array and sort by USD value
	return Array.from(aggregated.values())
		.map((t) => ({
			symbol: t.symbol,
			name: t.name,
			balance: t.totalBalance.toFixed(6),
			usdValue: t.totalUsdValue,
			decimals: t.decimals,
			logoUrl: t.logoUrl,
			chains: t.chains,
		}))
		.sort((a, b) => b.usdValue - a.usdValue)
}

export { balancesRoutes }
