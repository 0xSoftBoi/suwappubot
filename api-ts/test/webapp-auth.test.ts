import { describe, expect, it } from 'bun:test'
import { Effect, Option } from 'effect'
import { TelegramAuthService, TurnkeyService, UserService, WalletService } from '../src/services'
import { createTestApp, mockTelegramUser, serviceLayer } from './setup'

describe('webapp auth routes', () => {
	it('POST /webapp/validate returns valid:false without initData', async () => {
		const { app, cleanup } = await createTestApp()

		try {
			const response = await app.request('/webapp/validate', { method: 'POST' })
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ valid: false })
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/validate returns valid:true with valid initData', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/validate', {
				method: 'POST',
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as { valid: boolean; user?: { id: number } }
			expect(body.valid).toBe(true)
			expect(body.user?.id).toBe(mockTelegramUser.id)
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/telegram/auth returns JWT for valid user', async () => {
		const dbUser = {
			id: 42,
			telegramId: mockTelegramUser.id,
			username: mockTelegramUser.username,
			firstName: mockTelegramUser.first_name,
			lastName: mockTelegramUser.last_name ?? null,
		}
		const wallet = {
			id: 7,
			address: '0x1234567890123456789012345678901234567890',
			walletProvider: 'turnkey',
			turnkeySubOrgId: 'sub-org-1',
			turnkeyWalletId: 'wallet-1',
			turnkeyAccountId: 'account-1',
			chainType: 'evm',
			isActive: true,
			isDefault: true,
			userId: dbUser.id,
			name: 'Primary',
			createdAt: new Date(),
		}

		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getOrCreateUser: () => Effect.succeed({ user: dbUser, isNew: false }),
				}),
				serviceLayer(WalletService, {
					getActiveWallets: () => Effect.succeed([wallet]),
				}),
				serviceLayer(TurnkeyService, {
					createSubOrgForTelegramUser: () =>
						Effect.fail(new Error('not expected in existing wallet auth test')),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/telegram/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ initData: 'valid-init-data' }),
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as {
				success: boolean
				jwt?: string
				walletAddress?: string | null
			}
			expect(body.success).toBe(true)
			expect(typeof body.jwt).toBe('string')
			expect(body.walletAddress).toBe(wallet.address)
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/telegram/auth returns 400 for missing initData', async () => {
		const { app, cleanup } = await createTestApp()

		try {
			const response = await app.request('/webapp/telegram/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			})
			expect(response.status).toBe(400)

			const body = (await response.json()) as { success: boolean; error: string }
			expect(body.success).toBe(false)
			expect(body.error).toContain('Missing initData')
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/telegram/auth creates wallet for new user', async () => {
		const dbUser = {
			id: 42,
			telegramId: mockTelegramUser.id,
			username: mockTelegramUser.username,
			firstName: mockTelegramUser.first_name,
			lastName: mockTelegramUser.last_name ?? null,
		}
		let walletCreated = false

		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getOrCreateUser: () => Effect.succeed({ user: dbUser, isNew: true }),
				}),
				serviceLayer(WalletService, {
					getActiveWallets: () => Effect.succeed([]),
					createTurnkeyWallet: () => {
						walletCreated = true
						return Effect.succeed({
							id: 8,
							userId: dbUser.id,
							address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
							walletProvider: 'turnkey',
							turnkeySubOrgId: 'sub-org-2',
							turnkeyWalletId: 'wallet-2',
							turnkeyAccountId: 'account-2',
							chainType: 'evm',
							isActive: true,
							isDefault: true,
							name: 'Wallet',
							createdAt: new Date(),
						})
					},
				}),
				serviceLayer(TurnkeyService, {
					createSubOrgForTelegramUser: () =>
						Effect.succeed({
							subOrgId: 'sub-org-2',
							walletId: 'wallet-2',
							accountId: 'account-2',
							address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
						}),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/telegram/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ initData: 'valid-init-data' }),
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as {
				success: boolean
				walletAddress?: string | null
				isNewUser?: boolean
			}
			expect(body.success).toBe(true)
			expect(body.walletAddress).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
			expect(body.isNewUser).toBe(true)
			expect(walletCreated).toBe(true)
		} finally {
			await cleanup()
		}
	})
})
