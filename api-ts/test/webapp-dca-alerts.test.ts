import { describe, expect, it } from 'bun:test'
import { Effect, Option } from 'effect'
import { AlertService, DCAService, TelegramAuthService, UserService } from '../src/services'
import { createTestApp, mockTelegramUser, serviceLayer } from './setup'

const user = {
	id: 42,
	telegramId: mockTelegramUser.id,
	username: mockTelegramUser.username,
	firstName: mockTelegramUser.first_name,
	lastName: mockTelegramUser.last_name ?? null,
}

describe('webapp DCA and price alert routes', () => {
	it('GET /webapp/me/dca returns user orders', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(DCAService, {
					getUserOrders: () =>
						Effect.succeed([
							{ id: 1, userId: user.id, status: 'active', createdAt: new Date('2026-01-01T00:00:00Z') },
						]),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/dca', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)
			const body = (await response.json()) as Array<{ id: number; status: string }>
			expect(body).toHaveLength(1)
			expect(body[0]).toMatchObject({ id: 1, status: 'active' })
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/me/dca creates an order', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(DCAService, {
					createOrder: (params: { frequency: string; amountPerExecution: string }) =>
						Effect.succeed({
							id: 12,
							userId: user.id,
							status: params.frequency === 'daily' && params.amountPerExecution ? 'active' : 'failed',
							createdAt: new Date('2026-01-02T00:00:00Z'),
						}),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/dca', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Init-Data': 'valid-init-data',
				},
				body: JSON.stringify({
					fromChain: 'base',
					fromToken: '0x0',
					fromTokenSymbol: 'ETH',
					toChain: 'base',
					toToken: '0x1',
					toTokenSymbol: 'USDC',
					amountPerExecution: '100',
					frequency: 'daily',
					walletAddress: '0x1234567890123456789012345678901234567890',
				}),
			})
			expect(response.status).toBe(201)
			const body = (await response.json()) as { id: number; status: string }
			expect(body).toMatchObject({ id: 12, status: 'active' })
		} finally {
			await cleanup()
		}
	})

	it('GET /webapp/me/price-alerts returns alerts', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(AlertService, {
					getUserAlerts: () =>
						Effect.succeed([
							{ id: 5, userId: user.id, alertType: 'price', active: true, createdAt: new Date() },
						]),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/price-alerts?activeOnly=true', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)
			const body = (await response.json()) as Array<{ id: number; active: boolean }>
			expect(body).toHaveLength(1)
			expect(body[0]).toMatchObject({ id: 5, active: true })
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/me/price-alerts creates a price alert', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(AlertService, {
					createAlert: (params: { tokenSymbol: string; threshold: number }) =>
						Effect.succeed({
							id: 8,
							userId: user.id,
							alertType: 'price',
							active: params.tokenSymbol === 'ETH' && params.threshold === 3000,
							createdAt: new Date(),
						}),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/me/price-alerts', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Init-Data': 'valid-init-data',
				},
				body: JSON.stringify({
					chain: 'base',
					tokenAddress: '0x0',
					tokenSymbol: 'ETH',
					condition: 'above',
					threshold: 3000,
				}),
			})
			expect(response.status).toBe(201)
			const body = (await response.json()) as { id: number; active: boolean }
			expect(body).toMatchObject({ id: 8, active: true })
		} finally {
			await cleanup()
		}
	})
})
