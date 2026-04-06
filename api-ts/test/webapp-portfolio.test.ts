import { describe, expect, it } from 'bun:test'
import { Effect, Option } from 'effect'
import {
	BalanceService,
	SwapService,
	TelegramAuthService,
	UserService,
	WalletService,
} from '../src/services'
import { createTestApp, mockTelegramUser, serviceLayer } from './setup'

describe('webapp portfolio and wallet routes', () => {
	it('GET /webapp/portfolio returns tokens with USD values', async () => {
		const user = { id: 42, telegramId: mockTelegramUser.id }
		const wallet = {
			id: 7,
			userId: user.id,
			address: '0x1234567890123456789012345678901234567890',
			walletProvider: 'turnkey',
			chainType: 'evm',
			isActive: true,
			isDefault: true,
			name: 'Primary',
			createdAt: new Date(),
		}

		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(WalletService, {
					getActiveWallets: () => Effect.succeed([wallet]),
				}),
				serviceLayer(BalanceService, {
					getWalletBalances: () =>
						Effect.succeed([
							{
								symbol: 'ETH',
								name: 'Ether',
								address: 'native',
								chain: 'base',
								balance: '1.5',
								usdValue: 5250,
								decimals: 18,
							},
						]),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/portfolio', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as {
				totalUsdValue: number
				tokens: Array<{ symbol: string; usdValue: number }>
			}
			expect(body.totalUsdValue).toBe(5250)
			expect(body.tokens).toHaveLength(1)
			expect(body.tokens[0]).toMatchObject({ symbol: 'ETH', usdValue: 5250 })
		} finally {
			await cleanup()
		}
	})

	it('GET /webapp/wallets returns wallet list', async () => {
		const user = { id: 42, telegramId: mockTelegramUser.id }
		const wallet = {
			id: 7,
			userId: user.id,
			address: '0x1234567890123456789012345678901234567890',
			walletProvider: 'turnkey',
			chainType: 'evm',
			isActive: true,
			isDefault: true,
			name: 'Primary',
			createdAt: new Date(),
		}

		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(WalletService, {
					getActiveWallets: () => Effect.succeed([wallet]),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/wallets', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as {
				wallets: Array<{ address: string; provider: string }>
			}
			expect(body.wallets).toHaveLength(1)
			expect(body.wallets[0]).toMatchObject({
				address: wallet.address,
				provider: 'turnkey',
			})
		} finally {
			await cleanup()
		}
	})

	it('GET /webapp/swaps respects limit and offset', async () => {
		const user = { id: 42, telegramId: mockTelegramUser.id }
		let receivedLimit = -1
		let receivedOffset = -1

		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(SwapService, {
					getUserSwaps: (_userId: number, limit = 20, offset = 0) => {
						receivedLimit = limit
						receivedOffset = offset
						return Effect.succeed([
							{
								id: 99,
								userId: user.id,
								fromChain: 'base',
								toChain: 'ethereum',
								fromToken: 'ETH',
								toToken: 'USDC',
								fromAmount: '1000000000000000000',
								toAmount: '3000000000',
								fromAmountUsd: 3000,
								toAmountUsd: 3000,
								status: 'submitted',
								txHash: '0xtxhash',
								bridgeTxHash: null,
								destinationTxHash: null,
								idempotencyKey: null,
								routeProvider: 'lifi',
								routeData: null,
								gasFee: null,
								bridgeFee: null,
								slippage: 50,
								createdAt: new Date('2026-01-01T00:00:00Z'),
								updatedAt: new Date('2026-01-01T00:00:00Z'),
								completedAt: null,
								errorMessage: null,
								agentId: null,
								agentUuid: null,
							},
						])
					},
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/swaps?limit=5&offset=10', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as Array<{ id: string; txHash: string }>
			expect(receivedLimit).toBe(5)
			expect(receivedOffset).toBe(10)
			expect(body).toHaveLength(1)
			expect(body[0]).toMatchObject({ id: '99', txHash: '0xtxhash' })
		} finally {
			await cleanup()
		}
	})
})
