import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { UserService, WalletService, SwapService } from '../services'
import { runEffectEither } from '../runtime'
import { mapErrorToResponse, NotFoundError } from '../errors'

const usersRoutes = new Hono()

// GET /users/:id/wallets
usersRoutes.get('/:id/wallets', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)

			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			// Get wallets
			const wallets = yield* walletService.getUserWallets(userId)

			return wallets.map((wallet) => ({
				id: wallet.id,
				name: wallet.name,
				address: wallet.address,
				chainType: wallet.chainType,
				walletProvider: wallet.walletProvider,
				isActive: wallet.isActive,
				isDefault: wallet.isDefault,
				createdAt: wallet.createdAt?.toISOString(),
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// GET /users/:id/portfolio
usersRoutes.get('/:id/portfolio', async (c) => {
	const userId = Number(c.req.param('id'))

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)

			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			// Get active wallets
			const wallets = yield* walletService.getActiveWallets(userId)

			// Return placeholder portfolio data
			return {
				totalUsdValue: 0,
				tokens: wallets.map((wallet) => ({
					symbol: wallet.chainType === 'solana' ? 'SOL' : 'ETH',
					name: wallet.chainType === 'solana' ? 'Solana' : 'Ethereum',
					address: wallet.address,
					chain: wallet.chainType,
					balance: '0',
					usdValue: 0,
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

// GET /users/:id/swaps
usersRoutes.get('/:id/swaps', async (c) => {
	const userId = Number(c.req.param('id'))
	const limit = Number(c.req.query('limit') || 20)
	const offset = Number(c.req.query('offset') || 0)

	if (Number.isNaN(userId)) {
		return c.json({ error: 'Invalid user ID' }, 400)
	}

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const swapService = yield* SwapService

			// Verify user exists
			const userOption = yield* userService.getUserById(userId)

			if (Option.isNone(userOption)) {
				return yield* Effect.fail(new NotFoundError({ message: 'User not found', resource: 'user' }))
			}

			// Get swaps
			const swaps = yield* swapService.getUserSwaps(userId, limit, offset)

			return swaps.map((swap) => ({
				id: String(swap.id),
				fromChain: swap.fromChain,
				toChain: swap.toChain,
				fromToken: swap.fromToken,
				toToken: swap.toToken,
				fromAmount: swap.fromAmount,
				toAmount: swap.toAmount,
				fromAmountUsd: swap.fromAmountUsd,
				toAmountUsd: swap.toAmountUsd,
				status: swap.status,
				txHash: swap.txHash,
				bridgeTxHash: swap.bridgeTxHash,
				destinationTxHash: swap.destinationTxHash,
				createdAt: swap.createdAt?.toISOString() ?? '',
				completedAt: swap.completedAt?.toISOString() ?? null,
				errorMessage: swap.errorMessage,
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

export { usersRoutes }
