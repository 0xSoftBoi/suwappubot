import { Hono } from 'hono'
import { Effect, Either, Option } from 'effect'
import { telegramAuth } from '../middleware'
import { UserService, WalletService } from '../services'
import { runEffectEither } from '../runtime'
import type { TelegramUser } from '../services/TelegramAuthService'
import { mapErrorToResponse } from '../errors'

const walletsRoutes = new Hono()

// All wallet routes require Telegram auth
walletsRoutes.use('*', telegramAuth())

// GET /webapp/wallets - List all wallets for user
walletsRoutes.get('/', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return []
			}

			const user = userOption.value
			const wallets = yield* walletService.getActiveWallets(user.id)

			return wallets.map((wallet) => ({
				address: wallet.address,
				name: wallet.name || 'Wallet',
				chainType: wallet.chainType,
				provider: wallet.walletProvider,
				isDefault: wallet.isDefault,
				createdAt: wallet.createdAt?.toISOString() ?? null,
			}))
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

// POST /webapp/wallets - Add an external wallet
walletsRoutes.post('/', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const body = await c.req.json().catch(() => ({}))

	const { address, chainType, name } = body as {
		address?: string
		chainType?: 'evm' | 'solana'
		name?: string
	}

	if (!address) {
		return c.json({ error: 'Address is required' }, 400)
	}

	// Basic address validation
	const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(address)
	const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)

	if (!isEvmAddress && !isSolanaAddress) {
		return c.json({ error: 'Invalid wallet address' }, 400)
	}

	const detectedChainType = chainType || (isEvmAddress ? 'evm' : 'solana')

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			// Get or create user
			const { user } = yield* userService.getOrCreateUser({
				telegramId: telegramUser.id,
				username: telegramUser.username,
				firstName: telegramUser.first_name,
				lastName: telegramUser.last_name,
			})

			// Add external wallet
			const wallet = yield* walletService.addExternalWallet({
				userId: user.id,
				address,
				chainType: detectedChainType,
				name,
			})

			return {
				success: true,
				wallet: {
					address: wallet.address,
					name: wallet.name || 'Wallet',
					chainType: wallet.chainType,
					provider: wallet.walletProvider,
					isDefault: wallet.isDefault,
					createdAt: wallet.createdAt?.toISOString() ?? null,
				},
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right, 201)
})

// DELETE /webapp/wallets/:address - Remove a wallet
walletsRoutes.delete('/:address', async (c) => {
	const telegramUser = c.get('telegramUser') as TelegramUser
	const address = decodeURIComponent(c.req.param('address'))

	const result = await runEffectEither(
		Effect.gen(function* () {
			const userService = yield* UserService
			const walletService = yield* WalletService

			const userOption = yield* userService.getUserByTelegramId(telegramUser.id)

			if (Option.isNone(userOption)) {
				return { success: false, message: 'User not found' }
			}

			const user = userOption.value

			// Check if wallet exists and belongs to user
			const wallet = yield* walletService.getWalletByAddress(user.id, address)

			if (!wallet) {
				return { success: false, message: 'Wallet not found' }
			}

			// Don't allow removing Turnkey wallets
			if (wallet.walletProvider === 'turnkey') {
				return { success: false, message: 'Cannot remove primary Turnkey wallet' }
			}

			const removed = yield* walletService.removeWallet(user.id, address)

			return {
				success: removed,
				message: removed ? 'Wallet removed successfully' : 'Failed to remove wallet',
			}
		})
	)

	if (Either.isLeft(result)) {
		const { status, body } = mapErrorToResponse(result.left)
		return c.json(body, status as 200)
	}

	return c.json(result.right)
})

export { walletsRoutes }
